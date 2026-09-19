package com.bioreagent.service.impl;

import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.bioreagent.QueryParam.ReagentBatchQueryParam;
import com.bioreagent.dto.ReagentBatchDTO;
import com.bioreagent.entity.Reagent;
import com.bioreagent.entity.ReagentBatch;
import com.bioreagent.mapper.ReagentBatchMapper;
import com.bioreagent.mapper.ReagentMapper;
import com.bioreagent.result.PageResult;
import com.bioreagent.service.ReagentBatchService;
import com.bioreagent.vo.ReagentBatchVO;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Collectors;

@Service
public class ReagentBatchServiceImpl implements ReagentBatchService {

    @Autowired
    private ReagentBatchMapper reagentBatchMapper;

    @Autowired
    private ReagentMapper reagentMapper;

    @Override
    public PageResult<ReagentBatchVO> page(ReagentBatchQueryParam queryParam) {
        PageHelper.startPage(queryParam.getPage(), queryParam.getPageSize());
        List<ReagentBatch> list = reagentBatchMapper.list(queryParam);
        Page<ReagentBatch> p = (Page<ReagentBatch>) list;

        List<ReagentBatchVO> voList = p.getResult().stream().map(this::toVO).collect(Collectors.toList());
        return new PageResult<>(p.getTotal(), voList);
    }

    @Cacheable(value = "reagentBatch", key = "#id")
    @Override
    public ReagentBatchVO getById(Long id) {
        ReagentBatch batch = reagentBatchMapper.getById(id);
        return toVO(batch);
    }

    @CacheEvict(value = "reagentBatch", allEntries = true)
    @Override
    public void save(ReagentBatchDTO dto) {
        ReagentBatch batch = new ReagentBatch();
        BeanUtils.copyProperties(dto, batch);
        if (batch.getStatus() == null) {
            batch.setStatus(0); // 默认为在库(未开封)
        }
        if (batch.getCreateTime() == null) {
            batch.setCreateTime(LocalDateTime.now());
        }
        reagentBatchMapper.insert(batch);
    }

    @CacheEvict(value = "reagentBatch", key = "#dto.id")
    @Override
    public void update(ReagentBatchDTO dto) {
        ReagentBatch batch = new ReagentBatch();
        BeanUtils.copyProperties(dto, batch);
        reagentBatchMapper.update(batch);
    }

    @CacheEvict(value = "reagentBatch", key = "#id")
    @Override
    public void delete(Long id) {
        reagentBatchMapper.delete(id);
    }

    private ReagentBatchVO toVO(ReagentBatch batch) {
        ReagentBatchVO vo = new ReagentBatchVO();
        BeanUtils.copyProperties(batch, vo);
        // 填充试剂名称
        if (batch.getReagentId() != null) {
            Reagent reagent = reagentMapper.getById(batch.getReagentId());
            if (reagent != null) {
                vo.setReagentName(reagent.getName());
            }
        }
        return vo;
    }
}
