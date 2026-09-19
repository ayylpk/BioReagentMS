package com.bioreagent.service;

import com.bioreagent.QueryParam.DeliveryOrderQueryParam;
import com.bioreagent.result.PageResult;
import com.bioreagent.vo.DeliveryOrderVO;

public interface OutboundOrderAuditService {

    PageResult<DeliveryOrderVO> queryDeliveryOrder(DeliveryOrderQueryParam queryParam);

    /**
     * 审批通过出库单。
     * ⚠️ 签名里**刻意不含 reagentId/quantity**：扣哪个试剂、扣多少，只能由单据本身决定。
     *    此前这两个值是请求参数、服务端照单全收 —— 拿 A 试剂的单号配上 B 试剂的 reagentId，
     *    就能扣掉 B 的库存、并留下与单据对不上的出库流水。
     */
    void agree(Integer id);

    void reject(Integer id, String rejectionReason);
}
