package com.bioreagent.service;

import com.bioreagent.QueryParam.DeliveryOrderQueryParam;
import com.bioreagent.dto.DeliveryOrderDTO;
import com.bioreagent.result.PageResult;
import com.bioreagent.vo.DeliveryOrderVO;

public interface DeliveryOrderService {

    PageResult<DeliveryOrderVO> page(DeliveryOrderQueryParam queryParam);

    DeliveryOrderVO getById(Integer id);

    void add(DeliveryOrderDTO deliveryOrderDTO);

    void update(DeliveryOrderDTO deliveryOrderDTO);

    void delete(Integer id);
}
