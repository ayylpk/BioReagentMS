package com.bioreagent.service.impl;

import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.bioreagent.QueryParam.DeliveryOrderQueryParam;
import com.bioreagent.constant.DeliveryOrderStatus;
import com.bioreagent.constant.MessageConstant;
import com.bioreagent.context.BaseContext;
import com.bioreagent.dto.DeliveryOrderDTO;
import com.bioreagent.entity.DeliveryOrder;
import com.bioreagent.entity.ReagentBatch;
import com.bioreagent.mapper.DeliveryOrderMapper;
import com.bioreagent.mapper.ReagentBatchMapper;
import com.bioreagent.mapper.UserMapper;
import com.bioreagent.result.PageResult;
import com.bioreagent.service.DeliveryOrderService;
import com.bioreagent.vo.DeliveryOrderVO;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Collectors;

@Slf4j
@Service
public class DeliveryOrderServiceImpl implements DeliveryOrderService {

    @Autowired
    private DeliveryOrderMapper deliveryOrderMapper;

    @Autowired
    private UserMapper userMapper;

    @Autowired
    private ReagentBatchMapper reagentBatchMapper;

    @Override
    public PageResult<DeliveryOrderVO> page(DeliveryOrderQueryParam queryParam) {
        PageHelper.startPage(queryParam.getPage(), queryParam.getPageSize());

        List<DeliveryOrder> list = deliveryOrderMapper.list(queryParam);
        Page<DeliveryOrder> p = (Page<DeliveryOrder>) list;

        List<DeliveryOrderVO> voList = p.getResult().stream().map(this::toVO).collect(Collectors.toList());
        return new PageResult<>(p.getTotal(), voList);
    }

    @Cacheable(value = "deliveryOrder", key = "#id")
    @Override
    public DeliveryOrderVO getById(Integer id) {
        DeliveryOrder deliveryOrder = deliveryOrderMapper.getById(id);
        return toVO(deliveryOrder);
    }

    @CacheEvict(value = "deliveryOrder", allEntries = true)
    @Override
    public void add(DeliveryOrderDTO deliveryOrderDTO) {
        DeliveryOrder deliveryOrder = new DeliveryOrder();
        BeanUtils.copyProperties(deliveryOrderDTO, deliveryOrder);
        
        if (deliveryOrder.getStatus() == null) {
            deliveryOrder.setStatus(DeliveryOrderStatus.PENDING);
        }
        
        if (deliveryOrder.getDeliveryTime() == null) {
            deliveryOrder.setDeliveryTime(LocalDateTime.now());
        }

        // 设操作人
        Long currentId = BaseContext.getCurrentId();
        if (currentId != null) {
            deliveryOrder.setOperatorId(currentId.intValue());
            deliveryOrder.setOperatorName(userMapper.getById(currentId.intValue()).getName());
        }

        deliveryOrderMapper.insert(deliveryOrder);
    }

    @CacheEvict(value = "deliveryOrder", key = "#deliveryOrderDTO.id")
    @Override
    public void update(DeliveryOrderDTO deliveryOrderDTO) {
        if (deliveryOrderDTO.getId() != null) {
            DeliveryOrder existing = deliveryOrderMapper.getById(deliveryOrderDTO.getId());
            if (existing != null && DeliveryOrderStatus.APPROVED.equals(existing.getStatus())) {
                throw new RuntimeException(MessageConstant.OUTBOUND_APPROVED_NO_MODIFY);
            }
        }
        DeliveryOrder deliveryOrder = new DeliveryOrder();
        BeanUtils.copyProperties(deliveryOrderDTO, deliveryOrder);
        deliveryOrderMapper.update(deliveryOrder);
    }

    @CacheEvict(value = "deliveryOrder", key = "#id")
    @Override
    public void delete(Integer id) {
        // 已通过的单据不允许删除
        DeliveryOrder existing = deliveryOrderMapper.getById(id);
        if (existing != null && DeliveryOrderStatus.APPROVED.equals(existing.getStatus())) {
            throw new RuntimeException(MessageConstant.OUTBOUND_APPROVED_NO_DELETE);
        }
        deliveryOrderMapper.deleteById(id);
    }

    private DeliveryOrderVO toVO(DeliveryOrder deliveryOrder) {
        DeliveryOrderVO vo = new DeliveryOrderVO();
        BeanUtils.copyProperties(deliveryOrder, vo);
        // 填充批号
        if (deliveryOrder.getBatchId() != null) {
            ReagentBatch batch = reagentBatchMapper.getById(deliveryOrder.getBatchId());
            if (batch != null) {
                vo.setBatchNumber(batch.getBatchNumber());
            }
        }
        return vo;
    }
}
