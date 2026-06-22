package com.bioreagent.mapper;

import com.bioreagent.entity.Reagent;
import com.bioreagent.vo.InboundRankVO;
import com.bioreagent.vo.OutboundRankVO;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface ReportMapper {

    /** 库存最少的 10 种试剂 */
    List<Reagent> top10LowStock();

    /** 库存最多的 10 种试剂 */
    List<Reagent> top10HighStock();

    /** 一段时间内入库数量前 10 的试剂 */
    List<InboundRankVO> top10Inbound(@Param("startTime") LocalDateTime startTime, @Param("endTime") LocalDateTime endTime);

    /** 一段时间内出库数量前 10 的试剂 */
    List<OutboundRankVO> top10Outbound(@Param("startTime") LocalDateTime startTime, @Param("endTime") LocalDateTime endTime);
}
