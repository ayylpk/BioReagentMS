package com.bioreagent.controller;

import com.bioreagent.QueryParam.WarningRecordQueryParam;
import com.bioreagent.annotation.RequireRole;
import com.bioreagent.dto.WarningRecordDTO;
import com.bioreagent.result.PageResult;
import com.bioreagent.result.Result;
import com.bioreagent.service.WarningService;
import com.bioreagent.vo.WarningRecordVO;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

@RestController
@Slf4j
@RequestMapping("/warning")
public class WarningController {

    @Autowired
    private WarningService warningService;

    /** 分页查询预警列表（status=0 未处理 / status=1 已处理） */
    @GetMapping("/list")
    public Result<PageResult<WarningRecordVO>> page(WarningRecordQueryParam queryParam) {
        log.info("分页查询预警记录：{}", queryParam);
        PageResult<WarningRecordVO> pageResult = warningService.page(queryParam);
        return Result.success(pageResult);
    }

    /** 未处理预警数量（导航栏红点） */
    @GetMapping("/count")
    public Result<Integer> countUnresolved() {
        Integer count = warningService.countUnresolved();
        return Result.success(count);
    }

    /** 标记预警为已处理（含二次核验） */
    @RequireRole({0, 1})
    @PutMapping("/{id}/resolve")
    public Result resolve(@PathVariable Integer id,
                          @RequestParam(defaultValue = "0") Integer resolvedBy) {
        log.info("标记预警已处理：id={}, resolvedBy={}", id, resolvedBy);
        warningService.resolve(id, resolvedBy);
        return Result.success();
    }

    /** 新增预警（测试/手动触发用） */
    @RequireRole({0, 1})
    @PostMapping("/add")
    public Result add(@RequestBody WarningRecordDTO dto) {
        log.info("新增预警记录：{}", dto);
        warningService.add(dto);
        return Result.success();
    }
}
