package com.bioreagent.service.impl;


import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.bioreagent.QueryParam.ReagentQueryParam;
import com.bioreagent.dto.ReagentDTO;
import com.bioreagent.entity.Reagent;
import com.bioreagent.entity.Reagent;
import com.bioreagent.mapper.ReagentBatchMapper;
import com.bioreagent.mapper.ReagentMapper;
import com.bioreagent.result.PageResult;
import com.bioreagent.service.ReagentService;
import com.bioreagent.vo.ReagentVO;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.List;
import java.util.stream.Collectors;

@Slf4j
@Service
public class ReagentServiceImpl implements ReagentService {

    @Autowired
    private ReagentMapper reagentMapper;

    @Autowired
    private ReagentBatchMapper reagentBatchMapper;


    @Override
    public PageResult<ReagentVO> page(ReagentQueryParam reagentQueryParam) {
        PageHelper.startPage(reagentQueryParam.getPage(), reagentQueryParam.getPageSize());

        List<Reagent> list = reagentMapper.list(reagentQueryParam);
        Page<Reagent> p = (Page<Reagent>) list;

        List<ReagentVO> voList = p.getResult().stream().map(this::toVO).collect(Collectors.toList());
        return new PageResult<>(p.getTotal(), voList);
    }

    @Cacheable(value = "reagent", key = "#id")
    @Override
    public ReagentVO getById(Long id) {
        Reagent reagent = reagentMapper.getById(id);
        return toVO(reagent);
    }

    @CacheEvict(value = "reagent", allEntries = true)
    @Override
    public void add(ReagentDTO reagentDTO) {
        Reagent reagent = new Reagent();
        BeanUtils.copyProperties(reagentDTO, reagent);
        reagent.setCreateTime(LocalDate.now());
        reagentMapper.insert(reagent);
    }

    @CacheEvict(value = "reagent", key = "#reagentDTO.id")
    @Override
    public void update(ReagentDTO reagentDTO) {
        reagentMapper.update(reagentDTO);
    }

    @CacheEvict(value = "reagent", allEntries = true)
    @Override
    public void delete(List<Integer> ids) {
        // 先级联删除批次表数据，防止孤儿
        List<Long> longIds = ids.stream().map(Integer::longValue).collect(Collectors.toList());
        reagentBatchMapper.deleteByReagentIds(longIds);

        // 再删除主表
        reagentMapper.remove(ids);
    }


    private ReagentVO toVO(Reagent reagent) {
        ReagentVO vo = new ReagentVO();
        BeanUtils.copyProperties(reagent, vo);
        // totalStock → total，字段名不同，BeanUtils 拷不过去
        vo.setTotal(reagent.getTotalStock());
        return vo;
    }
}
