package com.bioreagent.QueryParam;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 预警记录分页查询参数
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class WarningRecordQueryParam {
    private Integer page = 1;
    private Integer pageSize = 10;
    /** 预警状态：0-未处理, 1-已处理，不传则查全部 */
    private Integer status;
    /** 预警类型：EXPIRY / SHORTAGE */
    private String warningType;
    /** 试剂名称（模糊搜索） */
    private String reagentName;
}
