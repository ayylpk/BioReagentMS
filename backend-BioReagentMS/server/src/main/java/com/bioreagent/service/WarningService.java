package com.bioreagent.service;

import com.bioreagent.QueryParam.WarningRecordQueryParam;
import com.bioreagent.dto.WarningRecordDTO;
import com.bioreagent.result.PageResult;
import com.bioreagent.vo.WarningRecordVO;

public interface WarningService {

    /** 分页查询预警列表 */
    PageResult<WarningRecordVO> page(WarningRecordQueryParam queryParam);

    /** 新增预警（定时任务/手动触发） */
    void add(WarningRecordDTO dto);

    /** 未处理预警数量（导航栏红点） */
    Integer countUnresolved();

    /** 标记预警为已处理（含二次核验） */
    void resolve(Integer warningId, Integer resolvedBy);

    /** 扫描全库生成预警（定时任务调用） */
    void generateWarnings();
}
