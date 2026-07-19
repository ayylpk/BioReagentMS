package com.bioreagent.controller;

import com.bioreagent.QueryParam.ReagentQueryParam;
import com.bioreagent.annotation.OperationAdd;
import com.bioreagent.annotation.OperationDelete;
import com.bioreagent.annotation.OperationUpdate;
import com.bioreagent.annotation.RequirePermission;
import com.bioreagent.dto.ReagentDTO;
import com.bioreagent.result.PageResult;
import com.bioreagent.result.Result;
import com.bioreagent.service.ReagentService;
import com.bioreagent.vo.ReagentVO;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/reagents/")
@Slf4j
public class ReagentController {

    @Autowired
    private ReagentService reagentService;

    @RequirePermission("reagent:query")
    @GetMapping
    public Result<PageResult<ReagentVO>> page(ReagentQueryParam reagentQueryParam){
        log.info("分页查询试剂信息：{}", reagentQueryParam);
        PageResult<ReagentVO> pageResult = reagentService.page(reagentQueryParam);
        return Result.success(pageResult);
    }

    @RequirePermission("reagent:query")
    @GetMapping("{id}")
    public Result getById(@PathVariable Long id){
        log.info("查询试剂信息：{}", id);
        ReagentVO reagentVO = reagentService.getById(id);
        return Result.success(reagentVO);
    }

    @OperationUpdate(module = "试剂")
    @RequirePermission("reagent:update")
    @PutMapping
    public Result update(@RequestBody ReagentDTO reagentDTO){
        log.info("更新试剂信息：{}", reagentDTO);
        reagentService.update(reagentDTO);
        return Result.success();
    }

    @OperationDelete(module = "试剂")
    @RequirePermission("reagent:delete")
    @DeleteMapping
    public Result delete(@RequestParam List<Integer> ids){
        log.info("删除试剂信息：{}", ids);
        reagentService.delete(ids);
        return Result.success();
    }

    @OperationAdd(module = "试剂")
    @RequirePermission("reagent:add")
    @PostMapping
    public Result add(@RequestBody ReagentDTO reagentDTO){
        log.info("新增试剂信息：{}", reagentDTO);
        reagentService.add(reagentDTO);
        return Result.success();
    }
}
