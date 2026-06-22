package com.bioreagent.controller;

import com.bioreagent.QueryParam.OperationQueryParam;
import com.bioreagent.dto.OperationDTO;
import com.bioreagent.result.PageResult;
import com.bioreagent.result.Result;
import com.bioreagent.service.OperationService;
import com.bioreagent.vo.OperationVO;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Slf4j
public class OperationController {

    @Autowired
    private OperationService operationService;

    public Result add(@RequestBody OperationDTO dto) {
        log.info("新增操作：{}", dto);
        operationService.add(dto);
        return Result.success();
    }
    @GetMapping("/operation/page")
    public Result<PageResult<OperationVO>> page(OperationQueryParam queryParam){
        log.info("分页查询操作日志：{}", queryParam);

        PageResult<OperationVO> pageResult = operationService.page(queryParam);

        return Result.success(pageResult);
    }

}
