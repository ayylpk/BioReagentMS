package com.bioreagent.controller;

import com.bioreagent.QueryParam.WebSearchResultsQueryParam;
import com.bioreagent.annotation.OperationAdd;
import com.bioreagent.annotation.OperationDelete;
import com.bioreagent.annotation.RequirePermission;
import com.bioreagent.entity.WebSearchResult;
import com.bioreagent.result.PageResult;
import com.bioreagent.result.Result;
import com.bioreagent.service.WebSearchResultService;
import com.bioreagent.vo.WebSearchResultVO;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

@RestController
@Slf4j
@RequestMapping("/webSearch")
public class WebSearchResultController {

    @Autowired
    private WebSearchResultService webSearchResultService;

    /** 分页查询 */
    @RequirePermission("webSearchResult:query")
    @GetMapping
    public Result<PageResult<WebSearchResultVO>> page(WebSearchResultsQueryParam queryParam) {
        log.info("分页查询搜索结果：{}", queryParam);
        PageResult<WebSearchResultVO> pageResult = webSearchResultService.page(queryParam);
        return Result.success(pageResult);
    }

    /** 按试剂名查单条 */
    @RequirePermission("webSearchResult:query")
    @GetMapping("/{reagentName}")
    public Result<WebSearchResultVO> getByReagentName(@PathVariable String reagentName) {
        log.info("按试剂名称查询：{}", reagentName);
        WebSearchResultVO vo = webSearchResultService.getByReagentName(reagentName);
        return Result.success(vo);
    }

    /** 新增 */
    @OperationAdd(module = "联网检索")
    @RequirePermission("webSearchResult:add")
    @PostMapping
    public Result add(@RequestBody WebSearchResult result) {
        log.info("新增检索结果：{}", result);
        webSearchResultService.add(result);
        return Result.success();
    }

    /** 删除 */
    @OperationDelete(module = "联网检索")
    @RequirePermission("webSearchResult:delete")
    @DeleteMapping("/{id}")
    public Result delete(@PathVariable Integer id) {
        log.info("删除检索结果：{}", id);
        webSearchResultService.delete(id);
        return Result.success();
    }
}
