package com.bioreagent.service;

import com.bioreagent.QueryParam.WarehouseReceiptQueryParam;
import com.bioreagent.dto.WarehouseReceiptDTO;
import com.bioreagent.result.PageResult;
import com.bioreagent.vo.WarehouseReceiptVO;

public interface WarehouseReceiptService {

    PageResult<WarehouseReceiptVO> page(WarehouseReceiptQueryParam queryParam);

    WarehouseReceiptVO getById(Long id);

    void add(WarehouseReceiptDTO warehouseReceiptDTO);

    void delete(Long id);
}
