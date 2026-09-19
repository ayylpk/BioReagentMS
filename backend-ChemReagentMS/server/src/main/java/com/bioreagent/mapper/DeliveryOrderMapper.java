package com.bioreagent.mapper;

import com.bioreagent.QueryParam.DeliveryOrderQueryParam;
import com.bioreagent.entity.DeliveryOrder;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;

import java.util.List;

@Mapper
public interface DeliveryOrderMapper {
    List<DeliveryOrder> list(DeliveryOrderQueryParam queryParam);

    DeliveryOrder getById(Integer id);

    void insert(DeliveryOrder deliveryOrder);

    void update(DeliveryOrder deliveryOrder);
    
    @Delete("delete from delivery_order where id = #{id}")
    void deleteById(Integer id);
}
