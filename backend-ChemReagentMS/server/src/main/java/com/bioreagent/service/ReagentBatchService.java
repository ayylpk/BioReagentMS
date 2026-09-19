package com.bioreagent.service;

import com.bioreagent.QueryParam.ReagentBatchQueryParam;
import com.bioreagent.dto.ReagentBatchDTO;
import com.bioreagent.result.PageResult;
import com.bioreagent.vo.ReagentBatchVO;

public interface ReagentBatchService {

    PageResult<ReagentBatchVO> page(ReagentBatchQueryParam queryParam);

    ReagentBatchVO getById(Long id);

    void save(ReagentBatchDTO dto);

    void update(ReagentBatchDTO dto);

    void delete(Long id);
}
