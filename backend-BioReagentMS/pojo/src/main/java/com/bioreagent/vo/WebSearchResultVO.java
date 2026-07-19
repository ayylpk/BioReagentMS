package com.bioreagent.vo;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class WebSearchResultVO {
    private Integer id;
    private String reagentName;
    private String casNumber;
    private String content;
    private LocalDateTime createTime;
}
