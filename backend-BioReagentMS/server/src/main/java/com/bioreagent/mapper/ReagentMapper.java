package com.bioreagent.mapper;

import com.bioreagent.QueryParam.ReagentQueryParam;
import com.bioreagent.dto.ReagentDTO;
import com.bioreagent.entity.Reagent;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

import java.util.List;

@Mapper
public interface ReagentMapper {

    /**
     * 根据条件查询试剂列表
     */
    List<Reagent> list(ReagentQueryParam reagentQueryParam);

    /**
     * 动态更新试剂信息
     */
    void update(ReagentDTO reagentDTO);

    /**
     * 新增试剂
     */
    void insert(Reagent reagent);

    Reagent getById(Long id);

    void remove(List<Integer> ids);
}
