package com.bioreagent.mapper;

import com.bioreagent.QueryParam.WarehouseReceiptQueryParam;
import com.bioreagent.entity.WarehouseReceipt;
import org.apache.ibatis.annotations.Mapper;

import java.util.List;

@Mapper
public interface WarehouseReceiptMapper {

    List<WarehouseReceipt> list(WarehouseReceiptQueryParam queryParam);

    WarehouseReceipt getById(Long id);

    void insert(WarehouseReceipt warehouseReceipt);

    void update(WarehouseReceipt warehouseReceipt);

    void deleteById(Long id);
}
