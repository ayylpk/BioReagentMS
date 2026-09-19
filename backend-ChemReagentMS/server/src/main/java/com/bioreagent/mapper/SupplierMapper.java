package com.bioreagent.mapper;

import com.bioreagent.QueryParam.SupplierQueryParm;
import com.bioreagent.entity.Supplier;
import org.apache.ibatis.annotations.Mapper;

import java.util.List;

@Mapper
public interface SupplierMapper {

    List<Supplier> list(SupplierQueryParm queryParam);

    Supplier getById(Integer id);

    void insert(Supplier supplier);

    void update(Supplier supplier);

    void delete(Integer id);
}
