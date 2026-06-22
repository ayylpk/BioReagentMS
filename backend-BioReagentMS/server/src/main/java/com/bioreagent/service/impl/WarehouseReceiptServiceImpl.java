package com.bioreagent.service.impl;

import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.bioreagent.QueryParam.WarehouseReceiptQueryParam;
import com.bioreagent.dto.WarehouseReceiptDTO;
import com.bioreagent.entity.ReagentBatch;
import com.bioreagent.entity.WarehouseReceipt;
import com.bioreagent.mapper.ReagentBatchMapper;
import com.bioreagent.mapper.WarehouseReceiptMapper;
import com.bioreagent.result.PageResult;
import com.bioreagent.service.WarehouseReceiptService;
import com.bioreagent.vo.WarehouseReceiptVO;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.stream.Collectors;

@Slf4j
@Service
public class WarehouseReceiptServiceImpl implements WarehouseReceiptService {

    @Autowired
    private WarehouseReceiptMapper warehouseReceiptMapper;

    @Autowired
    private ReagentBatchMapper reagentBatchMapper;

    @Override
    public PageResult<WarehouseReceiptVO> page(WarehouseReceiptQueryParam queryParam) {
        PageHelper.startPage(queryParam.getPage(), queryParam.getPageSize());

        List<WarehouseReceipt> list = warehouseReceiptMapper.list(queryParam);
        Page<WarehouseReceipt> p = (Page<WarehouseReceipt>) list;

        List<WarehouseReceiptVO> voList = p.getResult().stream().map(this::toVO).collect(Collectors.toList());
        return new PageResult<>(p.getTotal(), voList);
    }

    @Cacheable(value = "warehouseReceipt", key = "#id")
    @Override
    public WarehouseReceiptVO getById(Long id) {
        WarehouseReceipt warehouseReceipt = warehouseReceiptMapper.getById(id);
        return toVO(warehouseReceipt);
    }

    @CacheEvict(value = "warehouseReceipt", allEntries = true)
    @Override
    @Transactional
    public void add(WarehouseReceiptDTO warehouseReceiptDTO) {
        WarehouseReceipt warehouseReceipt = new WarehouseReceipt();
        BeanUtils.copyProperties(warehouseReceiptDTO, warehouseReceipt);
        
        if (warehouseReceipt.getReceiptTime() == null) {
            warehouseReceipt.setReceiptTime(LocalDateTime.now());
        }


        ReagentBatch newBatch = new ReagentBatch();
        newBatch.setReagentId(warehouseReceiptDTO.getReagentId());
        newBatch.setBatchNumber("BN-" + warehouseReceiptDTO.getReagentId() + "-"
                + LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss")));
        newBatch.setInitialQuantity(warehouseReceiptDTO.getQuantity());
        newBatch.setCurrentQuantity(warehouseReceiptDTO.getQuantity());
        newBatch.setUnitPrice(warehouseReceiptDTO.getUnitPrice());
        newBatch.setStatus(0);
        newBatch.setCreateTime(LocalDateTime.now());
        reagentBatchMapper.insert(newBatch);


        warehouseReceiptMapper.insert(warehouseReceipt);
    }

    @CacheEvict(value = "warehouseReceipt", key = "#id")
    @Override
    public void delete(Long id) {
        warehouseReceiptMapper.deleteById(id);
    }

    private WarehouseReceiptVO toVO(WarehouseReceipt warehouseReceipt) {
        WarehouseReceiptVO vo = new WarehouseReceiptVO();
        BeanUtils.copyProperties(warehouseReceipt, vo);
        return vo;
    }
}
