package com.bioreagent.service.impl;

import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.bioreagent.QueryParam.DeliveryOrderQueryParam;
import com.bioreagent.context.BaseContext;
import com.bioreagent.entity.DeliveryOrder;
import com.bioreagent.entity.ReagentBatch;
import com.bioreagent.mapper.OutboundOrderAuditMapper;
import com.bioreagent.mapper.ReagentBatchMapper;
import com.bioreagent.result.PageResult;
import com.bioreagent.service.OutboundOrderAuditService;
import com.bioreagent.vo.DeliveryOrderVO;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Collectors;

@Service
public class OutboundOrderAuditServiceImpl implements OutboundOrderAuditService {

    @Autowired
    private OutboundOrderAuditMapper outboundOrderAuditMapper;

    @Autowired
    private ReagentBatchMapper reagentBatchMapper;


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
        // 1. FEFO 扣库存：按效期升序，先用快过期的
        List<ReagentBatch> batches = reagentBatchMapper.listAvailableByReagentId(reagentId.longValue());
        int remain = quantity;
        for (ReagentBatch batch : batches) {
            if (remain <= 0) break;
            int available = batch.getCurrentQuantity() != null ? batch.getCurrentQuantity() : 0;
            int deduct = Math.min(available, remain);
            reagentBatchMapper.deductStock(batch.getId(), deduct);
            remain -= deduct;
            // 扣到 0 → 标为已用完
            if (available - deduct <= 0) {
                batch.setStatus(2);
                reagentBatchMapper.update(batch);
            }
        }
        if (remain > 0) {
            throw new RuntimeException("库存不足：还差 " + remain + " 个，无法出库");
        }

        // 2. 审批通过
        Long operatorId = BaseContext.getCurrentId();
        LocalDateTime now = LocalDateTime.now();
        outboundOrderAuditMapper.agree(id, operatorId, now);
    }

    @Override
    public void reject(Integer id, String rejectionReason) {
        Long operatorId = BaseContext.getCurrentId();
        LocalDateTime now = LocalDateTime.now();
        outboundOrderAuditMapper.reject(id, operatorId, now, rejectionReason);
    }

    private DeliveryOrderVO toVO(DeliveryOrder deliveryOrder) {
        DeliveryOrderVO vo = new DeliveryOrderVO();
        BeanUtils.copyProperties(deliveryOrder, vo);
        return vo;
    }
}
