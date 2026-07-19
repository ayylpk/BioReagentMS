package com.bioreagent.entity;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class WebSearchResult {
    private Integer id;
    private String reagentName;
    private String casNumber;
    private String content;
    private LocalDateTime createTime;
}
