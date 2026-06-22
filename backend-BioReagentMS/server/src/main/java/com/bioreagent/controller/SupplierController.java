package com.bioreagent.controller;

import com.bioreagent.QueryParam.SupplierQueryParm;
import com.bioreagent.annotation.RequireRole;
import com.bioreagent.dto.SupplierDTO;
import com.bioreagent.result.PageResult;
import com.bioreagent.result.Result;
import com.bioreagent.service.SupplierService;
import com.bioreagent.vo.SupplierVO;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/suppliers")
@Slf4j
public class SupplierController {

    @Autowired
    private SupplierService supplierService;

    @GetMapping
    public Result<PageResult<SupplierVO>> page(SupplierQueryParm supplierQueryParm) {
        log.info("分页查询供应商信息：{}", supplierQueryParm);
        PageResult<SupplierVO> pageResult = supplierService.page(supplierQueryParm);
        return Result.success(pageResult);
    }

    @GetMapping("/{id}")
    public Result<SupplierVO> getById(@PathVariable Integer id) {
        log.info("查询供应商详情：id={}", id);
        SupplierVO supplierVO = supplierService.getById(id);
        return Result.success(supplierVO);
    }

    @RequireRole({0, 3})
    @PostMapping("/add")
    public Result save(@RequestBody SupplierDTO supplierDTO) {
        log.info("新增供应商：{}", supplierDTO);
        supplierService.save(supplierDTO);
        return Result.success();
    }

    @RequireRole({0, 3})
    @PutMapping
    public Result update(@RequestBody SupplierDTO supplierDTO) {
        log.info("更新供应商：{}", supplierDTO);
        supplierService.update(supplierDTO);
        return Result.success();
    }

    @RequireRole({0})
    @DeleteMapping("/{id}")
    public Result delete(@PathVariable Integer id) {
        log.info("删除供应商：id={}", id);
        supplierService.delete(id);
        return Result.success();
    }
}
