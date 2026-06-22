package com.bioreagent.service;

import com.bioreagent.QueryParam.SupplierQueryParm;
import com.bioreagent.dto.SupplierDTO;
import com.bioreagent.result.PageResult;
import com.bioreagent.vo.SupplierVO;

public interface SupplierService {

    PageResult<SupplierVO> page(SupplierQueryParm supplierQueryParm);

    SupplierVO getById(Integer id);

    void save(SupplierDTO supplierDTO);

    void update(SupplierDTO supplierDTO);

    void delete(Integer id);
}
