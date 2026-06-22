package com.bioreagent.vo;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 出库排行 VO
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class OutboundRankVO {
    private Integer reagentId;      // 试剂ID
    private Integer totalQuantity;  // 出库总量
}
