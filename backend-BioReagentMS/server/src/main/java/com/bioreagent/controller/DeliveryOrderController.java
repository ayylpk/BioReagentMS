package com.bioreagent.controller;

import com.bioreagent.QueryParam.DeliveryOrderQueryParam;
import com.bioreagent.annotation.OperationAdd;
import com.bioreagent.annotation.OperationDelete;
import com.bioreagent.annotation.OperationUpdate;
import com.bioreagent.annotation.RequireRole;
import com.bioreagent.dto.DeliveryOrderDTO;
import com.bioreagent.result.PageResult;
import com.bioreagent.result.Result;
import com.bioreagent.service.DeliveryOrderService;
import com.bioreagent.vo.DeliveryOrderVO;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/deliveryOrder")
@Slf4j
public class DeliveryOrderController {

    @Autowired
    private DeliveryOrderService deliveryOrderService;

    @GetMapping
    public Result<PageResult<DeliveryOrderVO>> page(DeliveryOrderQueryParam queryParam) {
        log.info("分页查询出库单：{}", queryParam);
        PageResult<DeliveryOrderVO> pageResult = deliveryOrderService.page(queryParam);
        return Result.success(pageResult);
    }

    @GetMapping("/{id}")
    public Result<DeliveryOrderVO> getById(@PathVariable Integer id) {
        log.info("查询出库单：{}", id);
        DeliveryOrderVO deliveryOrderVO = deliveryOrderService.getById(id);
        return Result.success(deliveryOrderVO);
    }

    @OperationAdd(module = "出库")
    @RequireRole({0, 1, 2})
    @PostMapping
    public Result add(@RequestBody DeliveryOrderDTO deliveryOrderDTO) {
        log.info("新增出库单：{}", deliveryOrderDTO);
        deliveryOrderService.add(deliveryOrderDTO);
        return Result.success();
    }

    @OperationUpdate(module = "出库")
    @RequireRole({0, 1})
    @PutMapping
    public Result update(@RequestBody DeliveryOrderDTO deliveryOrderDTO) {
        log.info("更新出库单：{}", deliveryOrderDTO);
        deliveryOrderService.update(deliveryOrderDTO);
        return Result.success();
    }

    @OperationDelete(module = "出库")
    @RequireRole({0, 1})
    @DeleteMapping("/{id}")
    public Result delete(@PathVariable Integer id) {
        log.info("删除出库单：{}", id);
        deliveryOrderService.delete(id);
        return Result.success();
    }
}
