package com.bioreagent.mapper;

import com.bioreagent.QueryParam.OperationQueryParam;
import com.bioreagent.entity.Operation;
import com.bioreagent.vo.OperationVO;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;

import java.util.List;

@Mapper
public interface OperationMapper {

    @Insert("INSERT INTO operation_log (operator_id, module, action, target_id, detail, create_time) " +
            "VALUES (#{operatorId}, #{module}, #{action}, #{targetId}, #{detail}, #{createTime})")
    void insert(Operation operation);

    /** 分页查询，JOIN user 表返回含操作人姓名的 VO */
    List<OperationVO> list(OperationQueryParam queryParam);
}
