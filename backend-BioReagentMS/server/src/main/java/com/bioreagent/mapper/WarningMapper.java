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

    /** 按 ID 查单条 */
    @Select("SELECT * FROM warning_record WHERE id = #{id}")
    WarningRecord getById(Integer id);
}
