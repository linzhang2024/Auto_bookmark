#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
测试脚本：用于测试复杂层级文件夹的解析逻辑
"""

import os
import sys
from bookmark_converter import (
    parse_chrome_bookmarks,
    convert_to_markdown,
    count_bookmarks,
    count_folders,
    is_localhost_url
)


def create_complex_test_bookmarks():
    """
    创建复杂层级的测试 HTML 书签文件
    包含多层嵌套文件夹、混合内容、空文件夹等各种场景
    """
    html_content = '''<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" LAST_MODIFIED="1700000000" PERSONAL_TOOLBAR_FOLDER="true">书签栏</H3>
    <DL><p>
        <DT><A HREF="https://www.google.com" ADD_DATE="1700000001">Google</A>
        
        <DT><H3 ADD_DATE="1700000002" LAST_MODIFIED="1700000002">工作项目</H3>
        <DL><p>
            <DT><A HREF="https://www.github.com" ADD_DATE="1700000003">GitHub</A>
            
            <DT><H3 ADD_DATE="1700000004" LAST_MODIFIED="1700000004">前端项目</H3>
            <DL><p>
                <DT><A HREF="https://react.dev" ADD_DATE="1700000005">React 官方文档</A>
                <DT><A HREF="https://vuejs.org" ADD_DATE="1700000006">Vue.js 官方文档</A>
                
                <DT><H3 ADD_DATE="1700000007" LAST_MODIFIED="1700000007">组件库</H3>
                <DL><p>
                    <DT><A HREF="https://ant.design" ADD_DATE="1700000008">Ant Design</A>
                    <DT><A HREF="https://element-plus.org" ADD_DATE="1700000009">Element Plus</A>
                    
                    <DT><H3 ADD_DATE="1700000010" LAST_MODIFIED="1700000010">图标库</H3>
                    <DL><p>
                        <DT><A HREF="https://fontawesome.com" ADD_DATE="1700000011">Font Awesome</A>
                        <DT><A HREF="https://iconify.design" ADD_DATE="1700000012">Iconify</A>
                    </DL><p>
                </DL><p>
            </DL><p>
            
            <DT><H3 ADD_DATE="1700000013" LAST_MODIFIED="1700000013">后端项目</H3>
            <DL><p>
                <DT><A HREF="https://www.python.org" ADD_DATE="1700000014">Python</A>
                <DT><A HREF="https://nodejs.org" ADD_DATE="1700000015">Node.js</A>
                <DT><A HREF="http://localhost:8000" ADD_DATE="1700000016">本地后端服务</A>
            </DL><p>
        </DL><p>
        
        <DT><H3 ADD_DATE="1700000017" LAST_MODIFIED="1700000017">学习资源</H3>
        <DL><p>
            <DT><A HREF="https://www.udemy.com" ADD_DATE="1700000018">Udemy</A>
            <DT><A HREF="https://www.coursera.org" ADD_DATE="1700000019">Coursera</A>
            
            <DT><H3 ADD_DATE="1700000020" LAST_MODIFIED="1700000020">编程书籍</H3>
            <DL><p>
            </DL><p>
            
            <DT><H3 ADD_DATE="1700000021" LAST_MODIFIED="1700000021">视频教程</H3>
            <DL><p>
                <DT><A HREF="https://www.youtube.com" ADD_DATE="1700000022">YouTube</A>
            </DL><p>
        </DL><p>
        
        <DT><H3 ADD_DATE="1700000023" LAST_MODIFIED="1700000023">空文件夹</H3>
        <DL><p>
        </DL><p>
    </DL><p>
    
    <DT><A HREF="https://www.example.com" ADD_DATE="1700000024">Example</A>
    
    <DT><H3 ADD_DATE="1700000025" LAST_MODIFIED="1700000025">其他书签</H3>
    <DL><p>
        <DT><A HREF="https://www.wikipedia.org" ADD_DATE="1700000026">维基百科</A>
        <DT><A HREF="https://www.reddit.com" ADD_DATE="1700000027">Reddit</A>
        <DT><A HREF="http://127.0.0.1:4000" ADD_DATE="1700000028">本地前端服务</A>
        <DT><A HREF="https://www.test.com" ADD_DATE="1700000029"></A>
    </DL><p>
</DL><p>
'''
    return html_content


def test_complex_hierarchy():
    """
    测试复杂层级文件夹的解析逻辑
    """
    print("=" * 60)
    print("测试复杂层级文件夹的解析逻辑")
    print("=" * 60)
    
    # 创建复杂的测试数据
    html_content = create_complex_test_bookmarks()
    
    # 解析书签
    bookmarks = parse_chrome_bookmarks(html_content)
    
    # 统计文件夹和链接数量
    folder_count = count_folders(bookmarks)
    link_count = count_bookmarks(bookmarks)
    
    print(f"\n【统计结果】")
    print(f"  文件夹数量: {folder_count}")
    print(f"  链接数量: {link_count}")
    print(f"  总计项目: {folder_count + link_count}")
    
    # 转换为 Markdown
    markdown_content = convert_to_markdown(bookmarks)
    
    print(f"\n【生成的 Markdown 内容】")
    print("-" * 60)
    print(markdown_content)
    print("-" * 60)
    
    # 验证层级结构
    print(f"\n【验证层级结构】")
    
    # 预期的文件夹结构：
    # 1. 书签栏 (level 0)
    #    - 工作项目 (level 1)
    #      - 前端项目 (level 2)
    #        - 组件库 (level 3)
    #          - 图标库 (level 4)
    #      - 后端项目 (level 2)
    #    - 学习资源 (level 1)
    #      - 编程书籍 (level 2, 空文件夹)
    #      - 视频教程 (level 2)
    #    - 空文件夹 (level 1, 空文件夹)
    # 2. 其他书签 (level 0)
    
    expected_folders = [
        ("书签栏", 0),
        ("工作项目", 1),
        ("前端项目", 2),
        ("组件库", 3),
        ("图标库", 4),
        ("后端项目", 2),
        ("学习资源", 1),
        ("编程书籍", 2),
        ("视频教程", 2),
        ("空文件夹", 1),
        ("其他书签", 0),
    ]
    
    # 遍历解析结果，检查文件夹层级
    def check_folder_levels(items, expected, current_index=0):
        for item in items:
            if item['type'] == 'folder':
                if current_index < len(expected):
                    expected_name, expected_level = expected[current_index]
                    if item['name'] == expected_name and item['level'] == expected_level:
                        print(f"  [PASS] 文件夹 '{item['name']}' 层级正确 (level {item['level']})")
                    else:
                        print(f"  [FAIL] 文件夹 '{item['name']}' 层级错误")
                        print(f"         预期: name='{expected_name}', level={expected_level}")
                        print(f"         实际: name='{item['name']}', level={item['level']}")
                    current_index += 1
                else:
                    print(f"  [WARN] 意外的文件夹: '{item['name']}' (level {item['level']})")
                
                # 递归检查子文件夹
                if item['children']:
                    current_index = check_folder_levels(item['children'], expected, current_index)
        
        return current_index
    
    check_folder_levels(bookmarks, expected_folders)
    
    # 验证链接过滤
    print(f"\n【验证链接过滤】")
    
    # 预期的链接：
    # - Google
    # - GitHub
    # - React 官方文档
    # - Vue.js 官方文档
    # - Ant Design
    # - Element Plus
    # - Font Awesome
    # - Iconify
    # - Python
    # - Node.js
    # - Udemy
    # - Coursera
    # - YouTube
    # - Example
    # - 维基百科
    # - Reddit
    # - https://www.test.com (无标题)
    
    # 被过滤的链接：
    # - http://localhost:8000
    # - http://127.0.0.1:4000
    
    expected_links = [
        "Google",
        "GitHub",
        "React 官方文档",
        "Vue.js 官方文档",
        "Ant Design",
        "Element Plus",
        "Font Awesome",
        "Iconify",
        "Python",
        "Node.js",
        "Udemy",
        "Coursera",
        "YouTube",
        "Example",
        "维基百科",
        "Reddit",
        "https://www.test.com",
    ]
    
    # 收集所有链接
    def collect_links(items):
        links = []
        for item in items:
            if item['type'] == 'link':
                links.append(item['title'])
            elif item['type'] == 'folder' and item['children']:
                links.extend(collect_links(item['children']))
        return links
    
    actual_links = collect_links(bookmarks)
    
    print(f"  预期链接数量: {len(expected_links)}")
    print(f"  实际链接数量: {len(actual_links)}")
    
    # 检查是否所有预期链接都存在
    missing_links = []
    for link in expected_links:
        if link not in actual_links:
            missing_links.append(link)
    
    if missing_links:
        print(f"  [FAIL] 缺少链接: {missing_links}")
    else:
        print(f"  [PASS] 所有预期链接都存在")
    
    # 检查是否有意外的链接
    extra_links = []
    for link in actual_links:
        if link not in expected_links:
            extra_links.append(link)
    
    if extra_links:
        print(f"  [WARN] 意外的链接: {extra_links}")
    else:
        print(f"  [PASS] 没有意外的链接")
    
    # 验证无标题链接的处理
    print(f"\n【验证无标题链接处理】")
    if "https://www.test.com" in actual_links:
        print(f"  [PASS] 无标题链接已正确使用 URL 作为标题")
    else:
        print(f"  [FAIL] 无标题链接处理失败")
    
    # 验证本地链接过滤
    print(f"\n【验证本地链接过滤】")
    localhost_urls = [
        "http://localhost:8000",
        "http://127.0.0.1:4000"
    ]
    
    filtered_correctly = True
    for url in localhost_urls:
        if is_localhost_url(url):
            print(f"  [PASS] 链接 '{url}' 被正确识别为本地链接")
        else:
            print(f"  [FAIL] 链接 '{url}' 未被识别为本地链接")
            filtered_correctly = False
    
    # 检查这些链接是否真的被过滤了
    if "本地后端服务" not in actual_links and "本地前端服务" not in actual_links:
        print(f"  [PASS] 本地链接已被正确过滤")
    else:
        print(f"  [FAIL] 本地链接未被正确过滤")
        filtered_correctly = False
    
    print(f"\n" + "=" * 60)
    print("测试完成")
    print("=" * 60)
    
    return {
        "folder_count": folder_count,
        "link_count": link_count,
        "bookmarks": bookmarks,
        "markdown": markdown_content
    }


def test_edge_cases():
    """
    测试边界情况
    """
    print("\n" + "=" * 60)
    print("测试边界情况")
    print("=" * 60)
    
    # 测试空 HTML
    print("\n【测试空 HTML】")
    empty_html = "<html></html>"
    bookmarks = parse_chrome_bookmarks(empty_html)
    print(f"  解析结果: {bookmarks}")
    print(f"  文件夹数量: {count_folders(bookmarks)}")
    print(f"  链接数量: {count_bookmarks(bookmarks)}")
    
    # 测试只有 DL 标签的 HTML
    print("\n【测试只有 DL 标签的 HTML】")
    dl_only_html = "<DL><p></DL><p>"
    bookmarks = parse_chrome_bookmarks(dl_only_html)
    print(f"  解析结果: {bookmarks}")
    print(f"  文件夹数量: {count_folders(bookmarks)}")
    print(f"  链接数量: {count_bookmarks(bookmarks)}")
    
    # 测试 is_localhost_url 函数
    print("\n【测试 is_localhost_url 函数】")
    test_urls = [
        ("https://www.google.com", False),
        ("http://localhost:4000", True),
        ("http://127.0.0.1:8080", True),
        ("https://localhost.example.com", False),
        ("https://127.0.0.1.example.com", False),
        ("http://LocalHost:4000", True),
        ("http://127.0.0.1:8080/api", True),
        ("", False),
        (None, False),
    ]
    
    all_passed = True
    for url, expected in test_urls:
        actual = is_localhost_url(url)
        status = "[PASS]" if actual == expected else "[FAIL]"
        if actual != expected:
            all_passed = False
        print(f"  {status} is_localhost_url('{url}') = {actual} (预期: {expected})")
    
    if all_passed:
        print(f"  [PASS] 所有测试通过")
    else:
        print(f"  [FAIL] 部分测试失败")
    
    print(f"\n" + "=" * 60)
    print("边界情况测试完成")
    print("=" * 60)


if __name__ == '__main__':
    # 运行主要测试
    test_result = test_complex_hierarchy()
    
    # 运行边界情况测试
    test_edge_cases()
    
    # 显示最终统计
    print("\n" + "=" * 60)
    print("最终统计")
    print("=" * 60)
    print(f"  文件夹数量: {test_result['folder_count']}")
    print(f"  链接数量: {test_result['link_count']}")
    print(f"  总计: {test_result['folder_count'] + test_result['link_count']} 个项目")
