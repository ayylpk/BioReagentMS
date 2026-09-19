package com.bioreagent.mapper;

import com.bioreagent.QueryParam.WarningRecordQueryParam;
import com.bioreagent.dto.WarningRecordDTO;
import com.bioreagent.entity.WarningRecord;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface WarningMapper {

    /**
     * 插入预警记录（用 DTO，不传整个 Entity）
     */
    void insert(WarningRecordDTO dto);

    /**
     * 标记已处理：只改三个字段，轻量
     */
    void resolve(@Param("id") Integer id,
                 @Param("status") Integer status,
                 @Param("resolveTime") LocalDateTime resolveTime,
                 @Param("resolvedBy") Integer resolvedBy);

    /** 分页条件查询 */
    List<WarningRecord> page(WarningRecordQueryParam queryParam);

    /** 按状态统计数量（导航栏红点） */
    @Select("SELECT COUNT(*) FROM warning_record WHERE status = #{status}")
    Integer countByStatus(Integer status);

    /**
     * 去重查询：同一试剂 + 同一类型 + 同一状态是否已有记录
     */
    WarningRecord getByReagentAndType(@Param("reagentId") Integer reagentId,
                                      @Param("warningType") String warningType,
                                      @Param("status") Integer status);

    /**
     * 去重查询（**含批次维度**）：同一试剂 + 同一批次 + 同一类型 + 同一状态是否已有记录。
     * 效期预警必须用这个：一个试剂可能同时有好几批临近过期，若只按
     * (reagentId, warningType, status) 去重，只有最先扫到的那批会生成预警，
     * 剩下的批次永远不会出现在预警列表里（用户按批号处理完第一批，也收不到第二批的提醒）。
     */
    WarningRecord getByReagentAndBatchAndType(@Param("reagentId") Integer reagentId,
                                              @Param("reagentBatch") String reagentBatch,
                                              @Param("warningType") String warningType,
                                              @Param("status") Integer status);

    /** 按 ID 查单条 */
    @Select("SELECT * FROM warning_record WHERE id = #{id}")
    WarningRecord getById(Integer id);
}
