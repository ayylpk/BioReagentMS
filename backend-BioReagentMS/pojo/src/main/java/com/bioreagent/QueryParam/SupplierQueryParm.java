package com.bioreagent.QueryParam;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class SupplierQueryParm {
    private Integer page = 1;
    private Integer pageSize = 10;
    private String name;
}
