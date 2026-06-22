package com.bioreagent.vo;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class InboundReportVO {

    private Integer totalOfTime;    // 总次数
    private Integer totalOfKind;    // 总种类
    private Integer totalOfStock;   // 总入库数量
    private Double totalOfPrice;    // 总入库金额

    private List<InboundRecordVO> recordList; // 入库明细列表
}
