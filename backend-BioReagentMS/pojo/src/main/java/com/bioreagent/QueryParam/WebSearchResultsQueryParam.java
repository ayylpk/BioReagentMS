package com.bioreagent.QueryParam;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class WebSearchResultsQueryParam {
    private Integer page = 1;
    private Integer pageSize = 10;
    private Integer status;
    private String reagentName;
}
