package com.bioreagent.vo;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 入库排行 VO
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class InboundRankVO {
    private Long reagentId;         // 试剂ID
    private Integer totalQuantity;  // 入库总量
}
