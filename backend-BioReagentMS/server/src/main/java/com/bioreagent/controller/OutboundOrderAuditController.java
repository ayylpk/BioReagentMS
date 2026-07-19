package com.bioreagent.controller;

import com.bioreagent.QueryParam.DeliveryOrderQueryParam;
import com.bioreagent.annotation.OperationAudit;
import com.bioreagent.annotation.RequirePermission;
import com.bioreagent.result.PageResult;
import com.bioreagent.result.Result;
import com.bioreagent.service.OutboundOrderAuditService;
import com.bioreagent.vo.DeliveryOrderVO;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Slf4j
@RestController
@RequestMapping("/outboundOrderAudit")
public class OutboundOrderAuditController {

    @Autowired
    private OutboundOrderAuditService outboundOrderAuditService;

    @RequirePermission("delivery:query")
    @GetMapping
    public Result<PageResult<DeliveryOrderVO>> queryDeliveryOrder(DeliveryOrderQueryParam queryParam) {
        log.info("分页查询未审核的出库单：{}", queryParam);
        PageResult<DeliveryOrderVO> pageResult = outboundOrderAuditService.queryDeliveryOrder(queryParam);
        return Result.success(pageResult);
    }

    @OperationAudit(module = "出库")
    @RequirePermission("delivery:audit")
    @PutMapping("/agree")
    public Result agree(Integer id, Integer reagentId, String reagentName, Integer quantity) {
        log.info("同意出库单：id={}, reagentId={}, reagentName={}, quantity={}", id, reagentId, reagentName, quantity);
        outboundOrderAuditService.agree(id, reagentId, quantity);
        return Result.success();
    }

    @OperationAudit(module = "出库")
    @RequirePermission("delivery:audit")
    @PutMapping("/reject")
    public Result reject(Integer id, String rejectionReason) {
        log.info("拒绝出库单：{}", id);
        outboundOrderAuditService.reject(id, rejectionReason);
        return Result.success();
    }
}
