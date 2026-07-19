package com.bioreagent.controller;

import com.bioreagent.QueryParam.ReagentBatchQueryParam;
import com.bioreagent.annotation.OperationAdd;
import com.bioreagent.annotation.OperationDelete;
import com.bioreagent.annotation.OperationUpdate;
import com.bioreagent.annotation.RequirePermission;
import com.bioreagent.dto.ReagentBatchDTO;
import com.bioreagent.result.PageResult;
import com.bioreagent.result.Result;
import com.bioreagent.service.ReagentBatchService;
import com.bioreagent.vo.ReagentBatchVO;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/reagentBatches")
@Slf4j
public class ReagentBatchController {

    @Autowired
    private ReagentBatchService reagentBatchService;

    @RequirePermission("batch:query")
    @GetMapping
    public Result<PageResult<ReagentBatchVO>> page(ReagentBatchQueryParam queryParam) {
        log.info("分页查询批次库存：{}", queryParam);
        PageResult<ReagentBatchVO> pageResult = reagentBatchService.page(queryParam);
        return Result.success(pageResult);
    }

    @RequirePermission("batch:query")
    @GetMapping("/{id}")
    public Result<ReagentBatchVO> getById(@PathVariable Long id) {
        log.info("查询批次详情：id={}", id);
        ReagentBatchVO vo = reagentBatchService.getById(id);
        return Result.success(vo);
    }

    @OperationAdd(module = "批次")
    @RequirePermission("batch:add")
    @PostMapping
    public Result save(@RequestBody ReagentBatchDTO dto) {
        log.info("新增批次：{}", dto);
        reagentBatchService.save(dto);
        return Result.success();
    }

    @OperationUpdate(module = "批次")
    @RequirePermission("batch:update")
    @PutMapping
    public Result update(@RequestBody ReagentBatchDTO dto) {
        log.info("更新批次：{}", dto);
        reagentBatchService.update(dto);
        return Result.success();
    }

    @OperationDelete(module = "批次")
    @RequirePermission("batch:delete")
    @DeleteMapping("/{id}")
    public Result delete(@PathVariable Long id) {
        log.info("删除批次：id={}", id);
        reagentBatchService.delete(id);
        return Result.success();
    }
}
