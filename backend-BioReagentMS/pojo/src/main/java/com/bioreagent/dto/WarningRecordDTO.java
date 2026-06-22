package com.bioreagent.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 预警记录 DTO
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class WarningRecordDTO {

    private Integer id;
    private Integer reagentId;
    private String reagentName;
    private String reagentBatch;
    private String warningType;
    private Integer status;
}
