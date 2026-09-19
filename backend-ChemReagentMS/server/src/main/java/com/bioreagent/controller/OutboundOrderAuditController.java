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
    public Result agree(Integer id) {
        // 只收单号：试剂与数量一律以单据为准。
        // 旧签名额外收 reagentId/quantity，服务端直接拿去扣库存 —— 等于允许调用方指定"扣谁的货"。
        log.info("同意出库单：id={}", id);
        outboundOrderAuditService.agree(id);
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
