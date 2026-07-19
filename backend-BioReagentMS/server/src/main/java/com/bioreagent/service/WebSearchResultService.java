package com.bioreagent.service;

import com.bioreagent.QueryParam.WebSearchResultsQueryParam;
import com.bioreagent.entity.WebSearchResult;
import com.bioreagent.result.PageResult;
import com.bioreagent.vo.WebSearchResultVO;

public interface WebSearchResultService {
    PageResult<WebSearchResultVO> page(WebSearchResultsQueryParam queryParam);
    WebSearchResultVO getByReagentName(String reagentName);
    void add(WebSearchResult result);
    void delete(Integer id);
}
