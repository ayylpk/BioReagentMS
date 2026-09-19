package com.bioreagent.service.impl;

import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.bioreagent.QueryParam.DeliveryOrderQueryParam;
import com.bioreagent.constant.MessageConstant;
import com.bioreagent.constant.WarningConstant;
import com.bioreagent.context.BaseContext;
import com.bioreagent.exception.BaseException;
import com.bioreagent.dto.WarningRecordDTO;
import com.bioreagent.entity.DeliveryOrder;
import com.bioreagent.entity.Reagent;
import com.bioreagent.entity.ReagentBatch;
import com.bioreagent.entity.WarningRecord;
import com.bioreagent.mapper.DeliveryOrderMapper;
import com.bioreagent.mapper.OutboundOrderAuditMapper;
import com.bioreagent.mapper.ReagentBatchMapper;
import com.bioreagent.mapper.ReagentMapper;
import com.bioreagent.mapper.UserMapper;
import com.bioreagent.mapper.WarningMapper;
import com.bioreagent.result.PageResult;
import com.bioreagent.service.OutboundOrderAuditService;
import com.bioreagent.vo.DeliveryOrderVO;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import lombok.extern.slf4j.Slf4j;

import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Collectors;

@Slf4j
@Service
public class OutboundOrderAuditServiceImpl implements OutboundOrderAuditService {

    @Autowired
    private OutboundOrderAuditMapper outboundOrderAuditMapper;

    @Autowired
    private ReagentBatchMapper reagentBatchMapper;

    @Autowired
    private ReagentMapper reagentMapper;

    @Autowired
    private WarningMapper warningMapper;

    @Autowired
    private DeliveryOrderMapper deliveryOrderMapper;

    @Autowired
    private UserMapper userMapper;


    @Override
    public PageResult<DeliveryOrderVO> queryDeliveryOrder(DeliveryOrderQueryParam queryParam) {
        PageHelper.startPage(queryParam.getPage(), queryParam.getPageSize());
        List<DeliveryOrder> list = outboundOrderAuditMapper.list(queryParam);
        Page<DeliveryOrder> p = (Page<DeliveryOrder>) list;

        List<DeliveryOrderVO> voList = p.getResult().stream().map(this::toVO).collect(Collectors.toList());
        return new PageResult<>(p.getTotal(), voList);
    }

    @Override
    @Transactional
    @CacheEvict(value = {"reagent", "reagentBatch", "deliveryOrder"}, allEntries = true)
    public void agree(Integer id) {
        // 0. 取出原申请单
        DeliveryOrder origin = deliveryOrderMapper.getById(id);
        if (origin == null) {
            throw new BaseException("出库申请单不存在: " + id);
        }
        if (origin.getStatus() != null && origin.getStatus() != 0) {
            throw new BaseException("该申请单不是待审核状态，无法审批");
        }

        // ⚠️ 试剂与数量**一律以单据本身为准**，不接受调用方传入。
        //    旧实现直接拿请求参数里的 reagentId/quantity 去扣库存，等于"传什么就扣什么"：
        //    拿 A 试剂的申请单 id 配上 B 试剂的 reagentId，就能扣掉 B 的库存，
        //    并插出一条与单据内容对不上的出库流水（单据上的试剂从来没被校验过）。
        // 注意：实体里 reagentId 是 Integer（与 reagent 表主键同型），别按 Long 声明
        Integer reagentId = origin.getReagentId();
        int quantity = origin.getQuantity() != null ? origin.getQuantity() : 0;
        if (reagentId == null || quantity <= 0) {
            throw new BaseException("申请单缺少试剂或数量，无法出库");
        }

        Long operatorId = BaseContext.getCurrentId();
        LocalDateTime now = LocalDateTime.now();
        String approverName = operatorId != null ? userMapper.getById(operatorId.intValue()).getName() : null;

        // 1. FEFO 扣库存：按效期升序，先用快过期的
        List<ReagentBatch> batches = reagentBatchMapper.listAvailableByReagentId(reagentId.longValue());
        int remain = quantity;
        for (ReagentBatch batch : batches) {
            if (remain <= 0) break;
            int available = batch.getCurrentQuantity() != null ? batch.getCurrentQuantity() : 0;
            if (available <= 0) continue;
            int deduct = Math.min(available, remain);

            // 条件原子扣减（SQL 里带 current_quantity >= ? 守卫）：
            // 返回 0 表示这批货不够、或已被并发审批抢走 —— 跳过换下一批，绝不"先扣了再说"。
            int affected = reagentBatchMapper.deductStock(batch.getId(), deduct);
            if (affected == 0) continue;
            remain -= deduct;

            // 用完的批次标为已耗尽。用条件 SQL，**不要**拿内存旧快照整列 update：
            // 那样会把并发扣减的结果覆盖回旧值（10 - 8 = 2，把两次真实扣减抹成一次）。
            reagentBatchMapper.markDepletedIfEmpty(batch.getId());

            // 2. 每个被扣的批次插入一条出库记录（status=1 已通过）
            DeliveryOrder record = new DeliveryOrder();
            BeanUtils.copyProperties(origin, record, "id");
            record.setBatchId(batch.getId());
            record.setQuantity(deduct);
            record.setStatus(1);
            record.setApproverId(operatorId != null ? operatorId.intValue() : null);
            record.setApproverName(approverName);
            record.setApprovalTime(now);
            record.setDeliveryTime(now);
            if (record.getCreateTime() == null) {
                record.setCreateTime(now);
            }
            deliveryOrderMapper.insert(record);
        }

        if (remain > 0) {
            // 抛业务异常（BaseException），由全局处理器映射成 400 并把原因带回前端。
            // 旧写法抛 RuntimeException，会被兜底 handler 变成 500「系统繁忙」——
            // 用户只看到"系统故障"，不知道其实是库存不够（也无法据此提示）。
            throw new BaseException(MessageConstant.STOCK_INSUFFICIENT + "：还差 " + remain + " 个，无法出库");
        }

        // 3. 删除原待审核的申请单
        deliveryOrderMapper.deleteById(id);

        // 4. 扣库存后检查是否低于安全阈值，自动生成预警
        checkAndWarnShortage(reagentId);
    }

    @Override
    public void reject(Integer id, String rejectionReason) {
        Long operatorId = BaseContext.getCurrentId();
        LocalDateTime now = LocalDateTime.now();
        outboundOrderAuditMapper.reject(id, operatorId, now, rejectionReason);
    }

    /**
     * 出库后检查试剂总库存是否低于安全阈值，低于则生成库存不足预警
     */
    private void checkAndWarnShortage(Integer reagentId) {
        Reagent reagent = reagentMapper.getById(reagentId.longValue());
        if (reagent == null) return;

        Integer threshold = reagent.getSafetyStockThreshold();
        if (threshold == null || threshold <= 0) return;

        Integer totalStock = reagent.getTotalStock();
        if (totalStock == null) totalStock = 0;

        if (totalStock >= threshold) return;

        WarningRecord existing = warningMapper.getByReagentAndType(
                reagentId, WarningConstant.TYPE_SHORTAGE, WarningConstant.STATUS_UNRESOLVED);
        if (existing != null) {
            log.info("库存不足预警已存在，跳过 → reagentId={}", reagentId);
            return;
        }

        WarningRecordDTO dto = new WarningRecordDTO();
        dto.setReagentId(reagentId);
        dto.setReagentName(reagent.getName());
        dto.setWarningType(WarningConstant.TYPE_SHORTAGE);
        dto.setStatus(WarningConstant.STATUS_UNRESOLVED);
        warningMapper.insert(dto);
        log.info("出库后库存不足，自动生成预警 → reagentId={}, 当前库存={}, 阈值={}",
                reagentId, totalStock, threshold);
    }

    private DeliveryOrderVO toVO(DeliveryOrder deliveryOrder) {
        DeliveryOrderVO vo = new DeliveryOrderVO();
        BeanUtils.copyProperties(deliveryOrder, vo);
        return vo;
    }
}
