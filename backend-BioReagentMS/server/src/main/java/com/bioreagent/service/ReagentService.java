package com.bioreagent.service;

import com.bioreagent.QueryParam.ReagentQueryParam;
import com.bioreagent.dto.ReagentDTO;
import com.bioreagent.result.PageResult;
import com.bioreagent.vo.ReagentVO;

import java.util.List;

public interface ReagentService {

    /**
     * 分页查询试剂
     * @param reagentQueryParam 查询参数
     * @return 分页结果
     */
    PageResult<ReagentVO> page(ReagentQueryParam reagentQueryParam);

    /**
     * 根据ID查询试剂
     * @param id 试剂ID
     * @return 试剂信息
     */
    ReagentVO getById(Long id);

    /**
     * 新增试剂
     * @param reagentDTO 试剂信息
     */
    void add(ReagentDTO reagentDTO);

    void update(ReagentDTO reagentDTO);

    void delete(List<Integer> id);
}
