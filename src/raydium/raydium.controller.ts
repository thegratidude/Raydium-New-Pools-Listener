import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { RaydiumService } from './raydium.service.js';
import { CreateRaydiumDto } from './dto/create-raydium.dto.js';
import { UpdateRaydiumDto } from './dto/update-raydium.dto.js';

@Controller('raydium')
export class RaydiumController {
  constructor(private readonly raydiumService: RaydiumService) {}

  @Post()
  create(@Body() createRaydiumDto: CreateRaydiumDto) {
    return this.raydiumService.create(createRaydiumDto);
  }

  @Get()
  findAll() {
    return this.raydiumService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.raydiumService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateRaydiumDto: UpdateRaydiumDto) {
    return this.raydiumService.update(+id, updateRaydiumDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.raydiumService.remove(+id);
  }
}
