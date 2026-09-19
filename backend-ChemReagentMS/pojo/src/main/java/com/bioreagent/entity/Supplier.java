package com.bioreagent.entity;


import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class Supplier {
    private Integer id;
    private String name;
    private String linkman;
    private String phone;
    private String address;
    private String eMail;
}
