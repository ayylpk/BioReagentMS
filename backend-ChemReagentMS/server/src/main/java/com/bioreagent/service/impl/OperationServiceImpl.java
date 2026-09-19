package com.bioreagent.service.impl;

import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.bioreagent.QueryParam.OperationQueryParam;
import com.bioreagent.dto.OperationDTO;
import com.bioreagent.entity.Operation;
import com.bioreagent.mapper.OperationMapper;
import com.bioreagent.result.PageResult;
import com.bioreagent.service.OperationService;
import com.bioreagent.vo.OperationVO;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

@Service
public class OperationServiceImpl implements OperationService {

    @Autowired
    private OperationMapper operationMapper;

    @Override
    public void add(OperationDTO operationDTO) {
        Operation operation = new Operation();
        BeanUtils.copyProperties(operationDTO, operation);
        operation.setCreateTime(LocalDateTime.now());
        operationMapper.insert(operation);
    }

    @Override
    public PageResult<OperationVO> page(OperationQueryParam queryParam) {
        PageHelper.startPage(queryParam.getPage(), queryParam.getPageSize());

        List<OperationVO> list = operationMapper.list(queryParam);
        Page<OperationVO> p = (Page<OperationVO>) list;

        return new PageResult<>(p.getTotal(), list);
    }
}
