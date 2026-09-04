package com.github.paicoding.forum.service.image.service;

import com.github.paicoding.forum.core.util.ImageDimensionStore;
import com.github.paicoding.forum.core.util.Md5Util;
import com.github.paicoding.forum.service.image.repository.dao.ImageDimensionDao;
import com.github.paicoding.forum.service.image.repository.entity.ImageDimensionDO;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * 图片尺寸持久化实现：任何数据库异常都只记日志，不影响页面渲染
 *
 * @author YiHui
 * @date 2026/7/9
 */
@Slf4j
@Service
public class ImageDimensionStoreImpl implements ImageDimensionStore {
    private static final int MAX_URL_LENGTH = 1024;

    @Autowired
    private ImageDimensionDao imageDimensionDao;

    @Override
    public int[] find(String url) {
        try {
            ImageDimensionDO record = imageDimensionDao.getByUrlHash(Md5Util.encode(url));
            if (record == null || record.getWidth() == null || record.getHeight() == null
                    || record.getWidth() <= 0 || record.getHeight() <= 0) {
                return null;
            }
            return new int[]{record.getWidth(), record.getHeight()};
        } catch (Exception e) {
            log.warn("查询图片尺寸失败: {}", url, e);
            return null;
        }
    }

    @Override
    public void save(String url, int width, int height) {
        if (width <= 0 || height <= 0) {
            return;
        }

        try {
            String storedUrl = url.length() > MAX_URL_LENGTH ? url.substring(0, MAX_URL_LENGTH) : url;
            imageDimensionDao.insertOrUpdate(Md5Util.encode(url), storedUrl, width, height);
        } catch (Exception e) {
            log.warn("保存图片尺寸失败: {}", url, e);
        }
    }
}
