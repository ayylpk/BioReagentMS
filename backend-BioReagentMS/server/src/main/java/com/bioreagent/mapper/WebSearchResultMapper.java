package com.bioreagent.mapper;

import com.bioreagent.QueryParam.WebSearchResultsQueryParam;
import com.bioreagent.entity.WebSearchResult;
import org.apache.ibatis.annotations.Mapper;

import java.util.List;

@Mapper
public interface WebSearchResultMapper {

    List<WebSearchResult> list(WebSearchResultsQueryParam queryParam);

    WebSearchResult getByReagentName(String reagentName);

    void insert(WebSearchResult result);

    void deleteById(Integer id);
}
