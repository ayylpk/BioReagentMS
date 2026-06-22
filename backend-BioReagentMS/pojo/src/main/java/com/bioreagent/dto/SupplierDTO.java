package com.bioreagent.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class SupplierDTO {
    private Integer id;
    private String name;
    private String linkman;
    private String phone;
    private String address;
    private String eMail;
}
