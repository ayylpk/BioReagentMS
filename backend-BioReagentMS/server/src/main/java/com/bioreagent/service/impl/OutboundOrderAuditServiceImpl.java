package com.bioreagent.service.impl;

import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.bioreagent.QueryParam.DeliveryOrderQueryParam;
import com.bioreagent.constant.MessageConstant;
import com.bioreagent.constant.WarningConstant;
import com.bioreagent.context.BaseContext;
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
    public void agree(Integer id, Integer reagentId, Integer quantity) {
        // 0. 取出原申请单信息
        DeliveryOrder origin = deliveryOrderMapper.getById(id);
        Long operatorId = BaseContext.getCurrentId();
        LocalDateTime now = LocalDateTime.now();

        // 1. FEFO 扣库存：按效期升序，先用快过期的
        List<ReagentBatch> batches = reagentBatchMapper.listAvailableByReagentId(reagentId.longValue());
        int remain = quantity;
        for (ReagentBatch batch : batches) {
            if (remain <= 0) break;
            int available = batch.getCurrentQuantity() != null ? batch.getCurrentQuantity() : 0;
            int deduct = Math.min(available, remain);
            reagentBatchMapper.deductStock(batch.getId(), deduct);
            remain -= deduct;

            // 扣到 0  标为已用完
            if (available - deduct <= 0) {
                batch.setStatus(2);
                batch.setCurrentQuantity(0);
            } else {
                batch.setCurrentQuantity(available - deduct);
            }
            reagentBatchMapper.update(batch);

            // 2. 每个被扣的批次插入一条出库记录（status=1 已通过）
            DeliveryOrder record = new DeliveryOrder();
            BeanUtils.copyProperties(origin, record, "id");
            record.setBatchId(batch.getId());
            record.setQuantity(deduct);
            record.setStatus(1);
            record.setApproverId(operatorId != null ? operatorId.intValue() : null);
            if (operatorId != null) {
                record.setApproverName(userMapper.getById(operatorId.intValue()).getName());
            }
            record.setApprovalTime(now);
            record.setDeliveryTime(now);
            if (record.getCreateTime() == null) {
                record.setCreateTime(now);
            }
            deliveryOrderMapper.insert(record);
        }

        if (remain > 0) {
            throw new RuntimeException(MessageConstant.STOCK_INSUFFICIENT + "：还差 " + remain + " 个，无法出库");
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
