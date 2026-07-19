package com.bioreagent.service.impl;

import com.bioreagent.QueryParam.WebSearchResultsQueryParam;
import com.bioreagent.entity.WebSearchResult;
import com.bioreagent.mapper.WebSearchResultMapper;
import com.bioreagent.result.PageResult;
import com.bioreagent.service.WebSearchResultService;
import com.bioreagent.vo.WebSearchResultVO;
import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

@Service
public class WebSearchResultServiceImpl implements WebSearchResultService {

    @Autowired
    private WebSearchResultMapper webSearchResultMapper;

    @Override
    public PageResult<WebSearchResultVO> page(WebSearchResultsQueryParam queryParam) {
        PageHelper.startPage(queryParam.getPage(), queryParam.getPageSize());
        List<WebSearchResult> list = webSearchResultMapper.list(queryParam);
        Page<WebSearchResult> p = (Page<WebSearchResult>) list;

        List<WebSearchResultVO> voList = p.getResult().stream().map(this::toVO).collect(Collectors.toList());
        return new PageResult<>(p.getTotal(), voList);
    }

    @Override
    public WebSearchResultVO getByReagentName(String reagentName) {
        WebSearchResult result = webSearchResultMapper.getByReagentName(reagentName);
        return result != null ? toVO(result) : null;
    }

    @Override
    public void add(WebSearchResult result) {
        webSearchResultMapper.insert(result);
    }

    @Override
    public void delete(Integer id) {
        webSearchResultMapper.deleteById(id);
    }

    private WebSearchResultVO toVO(WebSearchResult webSearchResult) {
        WebSearchResultVO vo = new WebSearchResultVO();
        BeanUtils.copyProperties(webSearchResult, vo);
        return vo;
    }
}
