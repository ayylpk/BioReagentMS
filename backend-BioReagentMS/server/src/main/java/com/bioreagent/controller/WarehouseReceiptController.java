package com.bioreagent.controller;

import com.bioreagent.QueryParam.WarehouseReceiptQueryParam;
import com.bioreagent.annotation.OperationAdd;
import com.bioreagent.annotation.OperationDelete;
import com.bioreagent.annotation.RequireRole;
import com.bioreagent.dto.WarehouseReceiptDTO;
import com.bioreagent.result.PageResult;
import com.bioreagent.result.Result;
import com.bioreagent.service.WarehouseReceiptService;
import com.bioreagent.vo.WarehouseReceiptVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

@Slf4j
@RestController
@RequestMapping("/warehouse/receipt")
@Tag(name = "入库单管理接口")
public class WarehouseReceiptController {

    @Autowired
    private WarehouseReceiptService warehouseReceiptService;

    @GetMapping("/page")
    @Operation(summary = "分页查询入库单列表")
    public Result<PageResult<WarehouseReceiptVO>> page(WarehouseReceiptQueryParam queryParam) {
        log.info("分页查询入库单：{}", queryParam);
        PageResult<WarehouseReceiptVO> pageResult = warehouseReceiptService.page(queryParam);
        return Result.success(pageResult);
    }

    @GetMapping("/{id}")
    @Operation(summary = "根据ID查询入库单详情")
    public Result<WarehouseReceiptVO> getById(@PathVariable Long id) {
        log.info("查询入库单详情，ID：{}", id);
        WarehouseReceiptVO vo = warehouseReceiptService.getById(id);
        return Result.success(vo);
    }

    @OperationAdd(module = "入库")
    @RequireRole({0, 1})
    @PostMapping
    @Operation(summary = "新增入库单")
    public Result<Void> add(@RequestBody WarehouseReceiptDTO warehouseReceiptDTO) {
        log.info("新增入库单：{}", warehouseReceiptDTO);
        warehouseReceiptService.add(warehouseReceiptDTO);
        return Result.success();
    }

    @OperationDelete(module = "入库")
    @RequireRole({0, 1})
    @DeleteMapping("/{id}")
    @Operation(summary = "删除入库单")
    public Result<Void> delete(@PathVariable Long id) {
        log.info("删除入库单，ID：{}", id);
        warehouseReceiptService.delete(id);
        return Result.success();
    }
}
