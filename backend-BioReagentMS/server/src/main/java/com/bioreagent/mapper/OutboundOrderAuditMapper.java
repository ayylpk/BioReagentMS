package com.bioreagent.mapper;

import com.bioreagent.QueryParam.DeliveryOrderQueryParam;
import com.bioreagent.entity.DeliveryOrder;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface OutboundOrderAuditMapper {

    List<DeliveryOrder> list(DeliveryOrderQueryParam queryParam);

    @Update("update delivery_order set status = 1, approver_id = #{operatorId}, approval_time = #{approvalTime} where id = #{id}")
    void agree(@Param("id") Integer id, @Param("operatorId") Long operatorId, @Param("approvalTime") LocalDateTime approvalTime);

    @Update("update delivery_order set status = 2, approver_id = #{operatorId}, approval_time = #{approvalTime}, rejection_reason = #{rejectionReason} where id = #{id}")
    void reject(@Param("id") Integer id, @Param("operatorId") Long operatorId, @Param("approvalTime") LocalDateTime approvalTime, @Param("rejectionReason") String rejectionReason);
}
