package com.bioreagent.service;

import com.bioreagent.QueryParam.DeliveryOrderQueryParam;
import com.bioreagent.result.PageResult;
import com.bioreagent.vo.DeliveryOrderVO;

public interface OutboundOrderAuditService {

    PageResult<DeliveryOrderVO> queryDeliveryOrder(DeliveryOrderQueryParam queryParam);

    void agree(Integer id, Integer reagentId, Integer quantity);

    void reject(Integer id, String rejectionReason);
}
