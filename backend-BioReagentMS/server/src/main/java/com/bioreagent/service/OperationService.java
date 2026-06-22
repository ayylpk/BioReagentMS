package com.bioreagent.service;

import com.bioreagent.QueryParam.OperationQueryParam;
import com.bioreagent.dto.OperationDTO;
import com.bioreagent.result.PageResult;
import com.bioreagent.vo.OperationVO;

public interface OperationService {
    void add(OperationDTO dto);

    PageResult<OperationVO> page(OperationQueryParam queryParam);
}
