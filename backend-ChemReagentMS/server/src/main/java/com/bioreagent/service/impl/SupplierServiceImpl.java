package com.bioreagent.service.impl;

import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.bioreagent.QueryParam.SupplierQueryParm;
import com.bioreagent.dto.SupplierDTO;
import com.bioreagent.entity.Supplier;
import com.bioreagent.mapper.SupplierMapper;
import com.bioreagent.result.PageResult;
import com.bioreagent.service.SupplierService;
import com.bioreagent.vo.SupplierVO;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

@Service
public class SupplierServiceImpl implements SupplierService {

    @Autowired
    private SupplierMapper supplierMapper;

    @Override
    public PageResult<SupplierVO> page(SupplierQueryParm supplierQueryParm) {
        PageHelper.startPage(supplierQueryParm.getPage(), supplierQueryParm.getPageSize());
        List<Supplier> list = supplierMapper.list(supplierQueryParm);
        Page<Supplier> p = (Page<Supplier>) list;

        List<SupplierVO> voList = p.getResult().stream().map(this::toVO).collect(Collectors.toList());
        return new PageResult<>(p.getTotal(), voList);
    }

    @Cacheable(value = "supplier", key = "#id")
    @Override
    public SupplierVO getById(Integer id) {
        Supplier supplier = supplierMapper.getById(id);
        return toVO(supplier);
    }

    @CacheEvict(value = "supplier", allEntries = true)
    @Override
    public void save(SupplierDTO supplierDTO) {
        Supplier supplier = new Supplier();
        BeanUtils.copyProperties(supplierDTO, supplier);
        supplierMapper.insert(supplier);
    }

    @CacheEvict(value = "supplier", key = "#supplierDTO.id")
    @Override
    public void update(SupplierDTO supplierDTO) {
        Supplier supplier = new Supplier();
        BeanUtils.copyProperties(supplierDTO, supplier);
        supplierMapper.update(supplier);
    }

    @CacheEvict(value = "supplier", key = "#id")
    @Override
    public void delete(Integer id) {
        supplierMapper.delete(id);
    }

    private SupplierVO toVO(Supplier supplier) {
        SupplierVO vo = new SupplierVO();
        BeanUtils.copyProperties(supplier, vo);
        return vo;
    }
}
